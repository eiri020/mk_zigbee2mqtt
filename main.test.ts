
import { AssertionError } from 'assert';
import { ZigbeeDevice, main, zigbeeDevices } from './main';
import * as dotenv from 'dotenv';
import * as events from 'events';
import fs from 'fs';
import { ClientSubscribeCallback } from 'mqtt';

class MqttClientMock extends events.EventEmitter {
  subscribe = jest.fn((topic: string, opts: any, callback: ClientSubscribeCallback) => {
    callback(undefined, []);
  });
  publish = jest.fn();
  unsubscribe = jest.fn();
}

class MqttClientErrorMock extends events.EventEmitter {
  subscribe = jest.fn((topic: string, opts: any, callback: ClientSubscribeCallback) => {
    callback(new Error('error message'), []);
  });

  publish = jest.fn();
  unsubscribe = jest.fn();
}

jest.setTimeout(5000);

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function generateDevices(cnt: number, withCoordinator = false) {
  const devices = [];

  if(withCoordinator) {
    devices.push({
      friendly_name: `Coordinator`,
      ieee_address: `ieee`,
      type: 'Coordinator',
      definition: {
      },
    });
  }

  for(let i = 0; i < cnt; i++) {
    devices.push({
      friendly_name: `device ${i+1}`,
      ieee_address: `ieee ${i+1}`,
      type: 'Router',
      definition: {
        exposes: [
          {
            property: 'battery',
            type: 'numeric',
          },
        ],
      },
    });
  }

  return devices;
}

describe('mk_zigbee2mqtt', () => {

  let client:       MqttClientMock;
  let errorClient:  MqttClientErrorMock;
  let mockWrite: any;

  const deviceState = {
    battery: 45
  }

  beforeEach(() => {
    client = new MqttClientMock();
    errorClient = new MqttClientErrorMock();

    dotenv.config();
    process.env.MQTT_URL= 'mqtt://someurl';

    jest.spyOn(fs,'existsSync').mockReturnValue(true);
    jest.spyOn(fs,'mkdirSync').mockReturnValue('');
    mockWrite = jest.spyOn(fs, 'writeFile').mockReturnValue();
  })

  afterEach(() => {
    jest.restoreAllMocks();
    zigbeeDevices.clear();
  })

  describe('required configuration', () => {

    let mqtt;

    beforeEach(() => {

      mqtt = require('mqtt');
      mqtt.connect = jest.fn(() => {
        return client;
      });
    });

    it('should fail if MQTT_URL environment is not set', async () => {

      delete process.env.MQTT_URL;
      await expect(main).toThrow(AssertionError);
    })

    it('should set ZIGBEE2MQTT_TOPIC to zigbee2mqtt of not specified', async () => {
      delete process.env.ZIGBEE2MQTT_TOPIC;

      await main();

      expect(process.env.ZIGBEE2MQTT_TOPIC).toBe('zigbee2mqtt');
      expect(mqtt.connect).toBeCalled();
    });

    it('should set CHECKMK_PIGGYBAG to zigbee2mqtt of not specified', async () => {
      delete process.env.CHECKMK_PIGGYBAG;
  
      await main();
  
      expect(process.env.CHECKMK_PIGGYBAG).toBe('zigbee2mqtt');
      expect(mqtt.connect).toBeCalled();
    });

    it('should set SPOOL_DIR to /usr/lib/check_mk_agent/spool of not specified', async () => {
      delete process.env.SPOOL_DIR;
  
      await main();
  
      expect(process.env.SPOOL_DIR).toBe('/usr/lib/check_mk_agent/spool');
      expect(mqtt.connect).toBeCalled();
      expect(fs.mkdirSync).not.toBeCalled();
    });

    it('should create SPOOL_DIR if it does not exists', async () => {
      jest.spyOn(fs,'existsSync').mockReturnValue(false);

      await main();

      expect(fs.existsSync).toBeCalled();
      expect(fs.mkdirSync).toBeCalled();
      expect(mqtt.connect).toBeCalled();
    });

    it('should call connect with clientId checkmk_zigbee2mqtt when MQTT_CLIENT is not set', async () => {

      delete process.env.MQTT_CLIENT;

      await main();

      const connectOptions = mqtt.connect.mock.calls[0][1];

      expect(connectOptions.clientId).toBe('checkmk_zigbee2mqtt');
    });
  });

  describe('main tests', () => {

    const mqtt = require('mqtt');

    beforeEach(() => {
      mqtt.connect = jest.fn(() => {

        return client;
      })
    });

    it('should subscribe after the connection is established', (done) => {

      main();

      expect(mqtt.connect).toBeCalled();

      client.emit('connect');

      expect(client.subscribe).toBeCalled();

      // just for coverage
      client.emit('disconnect');
      client.emit('offline');
      client.emit('error', new Error('hi'));
    
      done();
    })

    it('should generate an error message if subscribe has failed', (done) => {

      const log = jest.spyOn(console, 'error').mockImplementation(() => {});

      mqtt.connect = jest.fn().mockReturnValue(errorClient)

      main();

      expect(mqtt.connect).toBeCalled();

      errorClient.emit('connect', new Error('some error'));

      expect(errorClient.subscribe).toHaveBeenCalled();
      done();
    });

    it('should sync devices if it receives the main/bridge/devices topic', () => {

      const devices = generateDevices(10);

      process.env.ZIGBEE2MQTT_TOPIC = 'main';

      mqtt.connect = jest.fn().mockReturnValue(client)

      main();

      expect(mqtt.connect).toBeCalled();

      client.emit('message', 'main/bridge/devices', Buffer.from(JSON.stringify(devices)));

      expect(zigbeeDevices.size).toBe(10);
      expect(mockWrite).toBeCalledTimes(10);
    });

    it('should sync devices with ieeee address if it receives the main/bridge/devices topic', () => {

      const devices = generateDevices(10);

      delete devices[2].friendly_name;

      process.env.ZIGBEE2MQTT_TOPIC = 'main';

      mqtt.connect = jest.fn().mockReturnValue(client)

      main();

      expect(mqtt.connect).toBeCalled();

      client.emit('message', 'main/bridge/devices', Buffer.from(JSON.stringify(devices)));

      expect(zigbeeDevices.size).toBe(10);
      expect(zigbeeDevices.get(devices[2].ieee_address)).toBeDefined();
    });

    it('should remove devices on the main/bridge/devices topic if they do not exists a second time', () => {

      const devices = generateDevices(10);

      process.env.ZIGBEE2MQTT_TOPIC = 'main';

      mqtt.connect = jest.fn().mockReturnValue(client)

      main();

      expect(mqtt.connect).toBeCalled();

      client.emit('message', 'main/bridge/devices', Buffer.from(JSON.stringify(devices)));

      expect(zigbeeDevices.size).toBe(10);

      jest.clearAllMocks();

      devices.splice(2,1);

      client.emit('message', 'main/bridge/devices', Buffer.from(JSON.stringify(devices)));

      expect(zigbeeDevices.size).toBe(9);
      expect(mockWrite).toBeCalledTimes(9);
    });

    it('should set the coordinatore state on the main/bridge/state topic', () => {
      const devices = generateDevices(10, true);

      process.env.ZIGBEE2MQTT_TOPIC = 'main';

      mqtt.connect = jest.fn().mockReturnValue(client)

      main();

      expect(mqtt.connect).toBeCalled();

      client.emit('message', 'main/bridge/devices', Buffer.from(JSON.stringify(devices)));

      expect(zigbeeDevices.size).toBe(11);

      client.emit('message', 'main/bridge/state', 'online');

      const coordinator = zigbeeDevices.get('Coordinator')

      expect(coordinator).toBeDefined();
      expect(coordinator.availability).toBe('online');
    });

    it('should not set the coordinatore state on the main/bridge/state topic if devices are not synced yet', () => {
      const devices = generateDevices(10, true);

      process.env.ZIGBEE2MQTT_TOPIC = 'main';

      mqtt.connect = jest.fn().mockReturnValue(client)

      main();

      expect(mqtt.connect).toBeCalled();

      expect(zigbeeDevices.size).toBe(0);

      client.emit('message', 'main/bridge/state', 'online');

      const coordinator = zigbeeDevices.get('Coordinator')

      expect(coordinator).not.toBeDefined();
    });

    it('should update a device availability when a device is synced', () => {
      const devices = generateDevices(10, true);

      process.env.ZIGBEE2MQTT_TOPIC = 'main';

      mqtt.connect = jest.fn().mockReturnValue(client);

      main();

      expect(mqtt.connect).toBeCalled();
      client.emit('message', 'main/bridge/devices', Buffer.from(JSON.stringify(devices)));

      expect(zigbeeDevices.size).toBe(11);

      client.emit('message', `main/${devices[2].friendly_name}/availability`, 'online');

      const device = zigbeeDevices.get(devices[2].friendly_name);

      expect(device).toBeDefined();
      expect(device.availability).toBe('online');
    })

    it('should not update a device availability when a device is not synced yet', () => {
      const devices = generateDevices(10, true);

      process.env.ZIGBEE2MQTT_TOPIC = 'main';

      mqtt.connect = jest.fn().mockReturnValue(client);

      main();

      expect(mqtt.connect).toBeCalled();
      client.emit('message', 'main/bridge/devices', Buffer.from(JSON.stringify(devices)));

      expect(zigbeeDevices.size).toBe(11);

      client.emit('message', `main/not_exists/availability`, 'online');

      const device = zigbeeDevices.get('not_exists');

      expect(device).not.toBeDefined();
    })

    it('should update a device state when a device is synced', () => {
      const devices = generateDevices(10, true);

      process.env.ZIGBEE2MQTT_TOPIC = 'main';

      mqtt.connect = jest.fn().mockReturnValue(client);

      main();

      expect(mqtt.connect).toBeCalled();
      client.emit('message', 'main/bridge/devices', Buffer.from(JSON.stringify(devices)));

      expect(zigbeeDevices.size).toBe(11);

      client.emit('message', `main/${devices[2].friendly_name}`, JSON.stringify(deviceState));

      const device = zigbeeDevices.get(devices[2].friendly_name);

      expect(device).toBeDefined();
      expect(device.state).toBeDefined();
    })

    it('should not update a device state when a device is not synced yet', () => {
      const devices = generateDevices(10, true);

      process.env.ZIGBEE2MQTT_TOPIC = 'main';

      mqtt.connect = jest.fn().mockReturnValue(client);

      main();

      expect(mqtt.connect).toBeCalled();
      client.emit('message', 'main/bridge/devices', Buffer.from(JSON.stringify(devices)));

      expect(zigbeeDevices.size).toBe(11);

      client.emit('message', `main/not_exists`, JSON.stringify(deviceState));

      const device = zigbeeDevices.get('not_exists');

      expect(device).not.toBeDefined();
    })

    it('should log an error if an exception occures during update', () => {

      const devices = generateDevices(10, true);

      process.env.ZIGBEE2MQTT_TOPIC = 'main';

      mqtt.connect = jest.fn().mockReturnValue(client);
      jest.spyOn(ZigbeeDevice.prototype, 'writeSpool').mockImplementation(() => { throw new Error('some error')})
      const mockLog = jest.spyOn(console, 'error');

      main();

      expect(mqtt.connect).toBeCalled();
      client.emit('message', 'main/bridge/devices', Buffer.from(JSON.stringify(devices)));
      client.emit('message', `main/${devices[2].friendly_name}`, JSON.stringify(deviceState));

      expect(ZigbeeDevice.prototype.writeSpool).toBeCalled();
      expect(mockLog).toBeCalled();
      
      const log = mockLog.mock.calls[0][0];
      expect(log).toContain('some error');

    });

  });

  describe("ZigbeeDevice class tests", () => {

    const zigbeeData = {
      friendly_name: 'some friendly name',
      ieee_address: 'some ieee address',
      type: 'Router',
      definition: {
        exposes: [
          {
            property: 'battery',
            type: 'numeric',
          },
        ],
      },
    };

    const zigbeeState = {
      battery: 45
    }

    it('should return the friend name if both are available', () => {
      const z = new ZigbeeDevice(zigbeeData);

      expect(z.name).toBe(zigbeeData.friendly_name);
    });

    it('should return the ieee address if friendly_name is not available', () => {
      const zd = JSON.parse(JSON.stringify(zigbeeData));
      delete zd.friendly_name;
      
      const z = new ZigbeeDevice(zd);

      expect(z.name).toBe(zigbeeData.ieee_address);
    });

    it('should return the type of device', () => {
      const zd = JSON.parse(JSON.stringify(zigbeeData));
      delete zd.friendly_name;
      
      const z = new ZigbeeDevice(zd);

      expect(z.type).toBe(zigbeeData.type);
    })

    it('should return battery definition if available and numeric', () => {
      const zd = JSON.parse(JSON.stringify(zigbeeData));
      const z = new ZigbeeDevice(zd);
  
      expect(z.batteryDef).toBeDefined();
    });

    it('should return undefined battery definition if definition does not exists', () => {
      const zd = JSON.parse(JSON.stringify(zigbeeData));
      delete zd.definition;

      const z = new ZigbeeDevice(zd);
  
      expect(z.batteryDef).not.toBeDefined();
    });


    it('should return undefined definition if available but not numeric numeric', () => {
      const zd = JSON.parse(JSON.stringify(zigbeeData));
      zd.definition.exposes[0].type = 'string';
      const z = new ZigbeeDevice(zd);
  
      expect(z.batteryDef).not.toBeDefined();
    });

    it('should return batterylevel 0 if no valid battery definition exist', () => {
      const zd = JSON.parse(JSON.stringify(zigbeeData));
      zd.definition.exposes[0].type = 'string';
      const z = new ZigbeeDevice(zd);
  
      expect(z.battery).toBe(0);
    })

    it('should return batterylevel 0 if no state is not set yet', () => {
      const zd = JSON.parse(JSON.stringify(zigbeeData));
      const z = new ZigbeeDevice(zd);
  
      expect(z.battery).toBe(0);
    })

    it('should return the batterylevel if state is set', () => {
      const zd = JSON.parse(JSON.stringify(zigbeeData));
      const z = new ZigbeeDevice(zd);

      z.setState(zigbeeState);
  
      expect(z.battery).toBe(zigbeeState.battery);
    })

    it('should set max age of from environment ROUTER_MAXAGE if the device is a Coordinator', () => {
      process.env.ROUTER_MAXAGE = '62321';

      const zd = JSON.parse(JSON.stringify(zigbeeData));
      zd.type = 'Coordinator';
      const z = new ZigbeeDevice(zd);
  
      expect(z.maxAge).toBe(62321);
    });

    it('should set max age of 6000 if environment ROUTER_MAXAGE is not a number', () => {
      process.env.ROUTER_MAXAGE = 'abc';

      const zd = JSON.parse(JSON.stringify(zigbeeData));
      zd.type = 'Coordinator';
      const z = new ZigbeeDevice(zd);
  
      expect(z.maxAge).toBe(6000);
    });

    it('should set max age from environment DEVICE_MAXAGE if the device is not a Router or Coordinatorr', () => {

      process.env.DEVICE_MAXAGE = '6435'

      const zd = JSON.parse(JSON.stringify(zigbeeData));
      zd.type = 'EndDevice';
      const z = new ZigbeeDevice(zd);
  
      expect(z.maxAge).toBe(6435);
    });

    it('should set max age of 90000 if environment DEVICE_MAXAGE is not a number', () => {
      process.env.DEVICE_MAXAGE = 'abc';

      const zd = JSON.parse(JSON.stringify(zigbeeData));
      zd.type = 'EndDevice';
      const z = new ZigbeeDevice(zd);
  
      expect(z.maxAge).toBe(90000);
    });

    it('should return unknown availability if not set', () => {
      const zd = JSON.parse(JSON.stringify(zigbeeData));
      const z = new ZigbeeDevice(zd);
  
      expect(z.availability).toBe('unknown');
    });

    it('should return availability if set', () => {
      const zd = JSON.parse(JSON.stringify(zigbeeData));
      const z = new ZigbeeDevice(zd);
      z.setAvailability('someavail');
      expect(z.availability).toBe('someavail');
    });

    it('should add batterylevel to spoolfile if battery level exists', () => {
      const zd = JSON.parse(JSON.stringify(zigbeeData));
      const z = new ZigbeeDevice(zd);
      z.setState(zigbeeState);

      const spoolContents = mockWrite.mock.calls[0][1];

      expect(spoolContents).toContain('battery=45;');
    });

    it('should not add batterylevel to spoolfile if battery level does not exists', () => {
      const zd = JSON.parse(JSON.stringify(zigbeeData));
      const z = new ZigbeeDevice(zd);
      z.setState(zigbeeState);

      const spoolContents = mockWrite.mock.calls[0][1];

      expect(spoolContents).not.toContain('battery=;');
    });

    it('should write 0 if availability is online', () => {
      const zd = JSON.parse(JSON.stringify(zigbeeData));
      const z = new ZigbeeDevice(zd);
      z.setAvailability('online');

      const spoolContents = mockWrite.mock.calls[0][1];

      expect(spoolContents).toMatch(/>>\n0 /);
    });

    it('should write 2 if availability is offline', () => {
      const zd = JSON.parse(JSON.stringify(zigbeeData));
      const z = new ZigbeeDevice(zd);
      z.setAvailability('offline');

      const spoolContents = mockWrite.mock.calls[0][1];

      expect(spoolContents).toMatch(/>>\n2 /);
    });

    it('should write 3 if availability is some state', () => {
      const zd = JSON.parse(JSON.stringify(zigbeeData));
      const z = new ZigbeeDevice(zd);
      z.setAvailability('somestate');

      const spoolContents = mockWrite.mock.calls[0][1];

      expect(spoolContents).toMatch(/>>\n3 /);
    });

    it('should write 3 if availability is not set', () => {
      const zd = JSON.parse(JSON.stringify(zigbeeData));
      const z = new ZigbeeDevice(zd);
      z.writeSpool();

      const spoolContents = mockWrite.mock.calls[0][1];

      expect(spoolContents).toMatch(/>>\n3 /);
    });

    it('should log an errror if writing of spool file files', () => {

      mockWrite = jest.spyOn(fs, 'writeFile').mockImplementation((path: string, data: string, callback: fs.NoParamCallback) => {
        callback(new Error('some error'))
      });

      const mockError = jest.spyOn(console, 'error');

      const zd = JSON.parse(JSON.stringify(zigbeeData));
      const z = new ZigbeeDevice(zd);
      z.writeSpool();

      const errMsg = mockError.mock.calls[0][0];
      expect(mockError).toHaveBeenCalled();

      expect(errMsg.message).toContain('some error')
    });
  });
});