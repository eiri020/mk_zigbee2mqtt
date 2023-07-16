import * as mqtt from 'mqtt';
import fs from 'fs';
import assert from 'assert';
import { globSync } from 'glob';
import { createLogger, format, transports, Logger } from 'winston';

// https://www.zigbee2mqtt.io/guide/configuration/device-availability.html

function tryParseInt(str: string, defaultValue: number) {
  var retValue = defaultValue;
  if(str !== null) {
    if(str != undefined && str.length > 0) {
      if (!isNaN(parseInt(str))) {
              retValue = parseInt(str);
          }
      }
  }
  return retValue;
}

export class ZigbeeDevice {
  private _availability: string;
  public availabilityDate?: Date;

  public stateDate?: Date;

  public device: any;
  public state?: any;
  public logger: Logger;

  public get name() {
    return this.device.friendly_name ?? this.device.ieee_address;
  }

  public get type() {
    return this.device.type;
  }

  public get battery() {
    return this.batteryDef ? this.state?.battery ?? 0 : 0;
  }

  public get maxAge() {
    if(this.device.type === 'Coordinator' || this.device.type === 'Router') {
      return tryParseInt(process.env.ROUTER_MAXAGE,6000);
    } else {
      return tryParseInt(process.env.DEVICE_MAXAGE,90000);
    }
  }

  public get batteryDef() {
    return this.device.definition?.exposes?.find(e => e.property === 'battery' && e.type === 'numeric')
  }

  public get availability() {
    return this._availability ?? 'unknown';
  }

  constructor(device: any, logger: Logger) 
  {
    this.logger = logger;
    this.syncDevice(device);
  }

  syncDevice(device: any) {
    this.device = device;
  }

  setAvailability(availability: string) {
    this._availability = availability;
    this.availabilityDate = new Date();
    this.writeSpool();
  }

  setState(state: any) {
    this.state = state;
    this.writeSpool();
  }

  writeSpool() {

    const existing = globSync(`${process.env.SPOOL_DIR}/*_${this.name}.txt`);
    existing.forEach(e => {
      try {
        fs.unlinkSync(e)
      } catch(err: any) {
        this.logger.error(` unkinking file ${e}: ${err.message}`);
      }
    });

    this.logger.info(`writing spool file for ${this.name}`);

    const lines: string[] = [];
    const metrics: string[] = [];

    if(this.batteryDef && this.state) {
      metrics.push(`battery=${this.battery};20;5;${this.batteryDef.value_min};${this.batteryDef.value_max}`);
    }

    lines.push(`<<<<${process.env.CHECKMK_PIGGYBAG}>>>>`);
    lines.push('<<<local>>>');

    let state;
    switch(this.availability) {
      case 'online':
        state = 0;
        break;
      case 'offline':
        state = 2;
        break;
      default:
        state = 3;
        break;
    }

    lines.push(`${state} ${this.name} ${metrics.length ? metrics.join('|') : '-'} Zigbee device ${this.name} state is ${this.availability}`);

    const filename = `${process.env.SPOOL_DIR}/${this.maxAge}_${this.name}.txt`;

    fs.writeFile(filename, lines.join('\n')+'\n<<<<>>>>\n', err => {
      if (err) {
        this.logger.error(err);
      }
    });

    const time = new Date();
    try {
      fs.utimesSync(filename, time, time);
    } catch (e) {
      let fd = fs.openSync(filename, 'a');
      fs.closeSync(fd);
    }
  }
}

export const zigbeeDevices = new Map<string,ZigbeeDevice>();

export const logger = createLogger({ 
  level: 'info', 
  format: format.combine(
    format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`+(info.splat!==undefined?`${info.splat}`:" "))
  ),
  transports: [
    new transports.Console(),
  ],
});


export function main() {

  logger.info('Starting mk_zigbee2mqtt');

  assert(process.env.MQTT_URL != undefined, 'Environment MQTT_URL should point to Masquitto server');

  process.env.ZIGBEE2MQTT_TOPIC ??= 'zigbee2mqtt';
  process.env.CHECKMK_PIGGYBAG ??= 'zigbee2mqtt';
  process.env.SPOOL_DIR ??= '/usr/lib/check_mk_agent/spool';

  logger.info(`Verifying spool directory ${process.env.SPOOL_DIR} ...`);

  if (!fs.existsSync(process.env.SPOOL_DIR)) {
    logger.info(`Creating spool directory ${process.env.SPOOL_DIR} ...`);
    fs.mkdirSync(process.env.SPOOL_DIR, { recursive: true });
  }

  logger.info(`Connecting to MQTT Server ${process.env.MQTT_URL} ...`);

  const client  = mqtt.connect(process.env.MQTT_URL, {
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASS,
    clientId: process.env.MQTT_CLIENT ?? 'checkmk_zigbee2mqtt',
  });

  client.on('connect', () => {

    logger.info(`Subscribing to MQTT topic ${process.env.ZIGBEE2MQTT_TOPIC}/# ...`);

    client.subscribe(`${process.env.ZIGBEE2MQTT_TOPIC}/#`, { rh: 1, qos: 0 }, function (err) {
      if (err) {
        logger.error(`Error subscribing to devices topic ${process.env.ZIGBEE2MQTT_TOPIC}/#: ${err}`);
      }
    });

    client.subscribe(`${process.env.ZIGBEE2MQTT_TOPIC}/bridge/state`, { rh: 1, qos: 0 }, function (err) {
      if (err) {
        logger.error(`Error subscribing to devices topic ${process.env.ZIGBEE2MQTT_TOPIC}/#: ${err}`);
      }
    });

  });

  client.on('disconnect', () => {
    logger.info('Disconnected from MQTT server')
  });

  client.on('offline', () => {
    logger.info('Client going offline')
  });

  client.on('error', (error) => {
    logger.error(`MQTT Error ${error}`);
  });

  client.on('message', (topic: string, message: Buffer) => {

    try {
      switch(topic) {
        case `${process.env.ZIGBEE2MQTT_TOPIC}/bridge/devices`:
          syncDevices(JSON.parse(message.toString()), logger);
          break;

        case `${process.env.ZIGBEE2MQTT_TOPIC}/bridge/state`:
          if(zigbeeDevices.size > 0)
            zigbeeDevices.get('Coordinator').setAvailability(message.toString())
          break;

        default:
          if(zigbeeDevices.size > 0 && !topic.startsWith(`${process.env.ZIGBEE2MQTT_TOPIC}/bridge/`)) {
            if(topic.endsWith('/availability')) {
              syncDeviceAvailability(topic, message.toString());
            } else {
              syncDeviceState(topic, message);
            }
          }
      }
    } catch(err: any) {
      logger.error(`Error processing topic ${topic}: ${err.message}`);
    }
  });

}

export function syncDevices(devices: any[], logger: Logger) {

  logger.info('Received devices topic from MQTT')

  let n = 0;

  for(let name of zigbeeDevices.keys()) {
    const z = zigbeeDevices.get(name);

    if (!devices.find(n => n.friendly_name === z.name || n.ieee_address === z.name)) {
      zigbeeDevices.delete(name);
      n++;
    }
  }

  if(n > 0) {
    logger.info(`${n} devices removed`);
  }

  n = 0;

  devices.forEach(d => {
    const z = zigbeeDevices.get(d.friendly_name) ?? zigbeeDevices.get(d.ieee_address);
    
    if(!z) {
      const name = d.friendly_name ?? d.ieee_address;
      const z = new ZigbeeDevice(d, logger)
      zigbeeDevices.set(name, z);
      z.writeSpool();
      n++;
    } else {
      z.writeSpool();
    }
  });  

  if(n > 0) {
    logger.info(`${n} devices added`);
  }

}

export function syncDeviceState(topic: string, message: Buffer) {

  const parts = topic.split('/');

  if(parts.length >= 2) {

    const device = parts[parts.length-1];

    const z = zigbeeDevices.get(device);
    if(z) {
      z.setState(JSON.parse(message.toString()));
    }
  }
}

export function syncDeviceAvailability(topic: string, availability: string) {

  const parts = topic.split('/');
  if(parts.length >= 3) {
    const device = parts[parts.length-2];

    const z = zigbeeDevices.get(device);
    if(z) {
      z.setAvailability(availability);
    }
  }
}

