import * as mqtt from 'mqtt';
import fs from 'fs';
import assert from 'assert';

export class ZigbeeDevice {
  private _availability: string;
  public availabilityDate?: Date;

  public stateDate?: Date;

  public device: any;
  public state?: any;

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
    return this.device.type === 'Coordinator' || this.device.type === 'Router' ? 10 * 60 : 25 * 3600;
  }

  public get batteryDef() {
    return this.device.definition?.exposes?.find(e => e.property === 'battery' && e.type === 'numeric')
  }

  public get availability() {
    return this._availability ?? 'unknown';
  }

  constructor(device: any) 
  {
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

    const lines: string[] = [];
    const metrics: string[] = [];

    if(this.batteryDef && this.state) {
      metrics.push(`battery=${this.battery};20;5;${this.batteryDef.value_min};${this.batteryDef.value_max}`);
    }

    lines.push(`<<<<${process.env.CHECKMK_PIGGYBAG}>>>>`);
    lines.push('<<<local>>>');

    let state = 3;
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

    fs.writeFile(`${process.env.SPOOL_DIR}/${this.maxAge}_${this.name}.txt`, lines.join('\n')+'<<<<>>>>\n', err => {
      if (err) {
        console.error(err);
      }
    });
  }
}

export const zigbeeDevices = new Map<string,ZigbeeDevice>();


export function main() {

  assert(process.env.MQTT_URL != undefined, 'Environment MQTT_URL should point to Masquitto server');

  process.env.ZIGBEE2MQTT_TOPIC ??= 'zigbee2mqtt';
  process.env.CHECKMK_PIGGYBAG ??= 'zigbee2mqtt';
  process.env.SPOOL_DIR ??= '/usr/lib/check_mk_agent/spool';

  console.info(`Verifying spool directory ${process.env.SPOOL_DIR} ...`);

  if (!fs.existsSync(process.env.SPOOL_DIR)) {
    fs.mkdirSync(process.env.SPOOL_DIR, { recursive: true });
  }

  console.info(`Connecting to MQTT Server ${process.env.MQTT_URL} ...`);

  const client  = mqtt.connect(process.env.MQTT_URL, {
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASS,
    clientId: process.env.MQTT_CLIENT ?? 'checkmk_zigbee2mqtt',
  });

  client.on('connect', () => {

    console.info(`Subscribing to MQTT topic ${process.env.ZIGBEE2MQTT_TOPIC}/# ...`);

    client.subscribe(`${process.env.ZIGBEE2MQTT_TOPIC}/#`, { rh: 1, qos: 0 }, function (err) {
      if (err) {
        console.error(`Error subscribing to devices topic ${process.env.ZIGBEE2MQTT_TOPIC}/#: ${err}`);
      }
    });
  });

  client.on('disconnect', () => {
    console.info('Disconnected from MQTT server')
  });

  client.on('offline', () => {
    console.info('Client going offline')
  });

  client.on('error', (error) => {
    console.error(`MQTT Error ${error}`);
  });

  client.on('message', (topic: string, message: Buffer) => {

    try {
      switch(topic) {
        case `${process.env.ZIGBEE2MQTT_TOPIC}/bridge/devices`:
          syncDevices(JSON.parse(message.toString()));
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
      console.error(`Error processing topic ${topic}: ${err.message}`);
    }
  });

}

export function syncDevices(devices: any[]) {

  console.info('Received devices topic from MQTT')

  let n = 0;

  for(let name of zigbeeDevices.keys()) {
    const z = zigbeeDevices.get(name);

    if (!devices.find(n => n.friendly_name === z.name || n.ieee_address === z.name)) {
      zigbeeDevices.delete(name);
      n++;
    }
  }

  if(n > 0) {
    console.info(`${n} devices removed`);
  }

  n = 0;

  devices.forEach(d => {
    const z = zigbeeDevices.get(d.friendly_name) ?? zigbeeDevices.get(d.ieee_address);
    
    if(!z) {
      const name = d.friendly_name ?? d.ieee_address;
      const z = new ZigbeeDevice(d)
      zigbeeDevices.set(name, z);
      z.writeSpool();
      n++;
    } else {
      z.writeSpool();
    }
  });  

  if(n > 0) {
    console.info(`${n} devices added`);
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

