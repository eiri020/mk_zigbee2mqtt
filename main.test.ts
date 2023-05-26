
import { AssertionError } from 'assert';
import { main } from './main';
import * as dotenv from 'dotenv';
import * as events from 'events';
import fs from 'fs';
import { ClientSubscribeCallback } from 'mqtt';
import { testEmitter, subscribeCallBack } from './example/emitterSubscriber';

export class MqttClientMock extends events.EventEmitter {
  subscribe = jest.fn((topic: string, opts: any, callback: ClientSubscribeCallback) => {
    callback(undefined, []);
  });
  publish = jest.fn();
  unsubscribe = jest.fn();
}

export class MqttClientErrorMock extends events.EventEmitter {
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

describe('emitterTests', () => {

  const mqtt = require('mqtt');

  let client:       MqttClientMock;

  beforeEach(() => {
    client = new MqttClientMock();

    mqtt.connect = jest.fn();
  })

  it('should subscribe after the connection is established', (done) => {

    testEmitter();

    expect(mqtt.connect).toBeCalled();

    client.emit('connect', new Error('you did wrong'));

    expect(client.subscribe).toBeCalled();

    done();
  })
});

describe.skip('mk_zigbee2mqtt', () => {

  let client:       MqttClientMock;
  let errorClient:  MqttClientErrorMock;

  beforeEach(() => {
    client = new MqttClientMock();
    errorClient = new MqttClientErrorMock();

    dotenv.config();
    process.env.MQTT_URL= 'mqtt://someurl';

    jest.spyOn(fs,'existsSync').mockReturnValue(true);
    jest.spyOn(fs,'mkdirSync').mockReturnValue('');

  })

  describe('required configuration', () => {

    let mqtt;

    beforeEach(() => {

      mqtt = require('mqtt');
      mqtt.connect = jest.fn(() => {
        return client;
      })

    });

    afterEach(() => {
      jest.restoreAllMocks();
    })

    it('should fail if MQTT_URL environment is not set', async () => {

      delete process.env.MQTT_URL;
      await expect(main).rejects.toThrow(AssertionError);
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

  describe('connection tests', () => {

    const mqtt = require('mqtt');

    beforeEach(() => {
      mqtt.connect = jest.fn(() => {

        setTimeout(() => {
          client.emit('connect');
        }, 1000);

        return client;
      })
    });

    it('should subscribe after the connection is established', (done) => {

      main();

      expect(mqtt.connect).toBeCalled();

      // client.emit('connect');

      expect(client.subscribe).toBeCalled();

      done();
    })

    it.skip('should generate an error message if subscribe has failed', (done) => {

      const log = jest.spyOn(console, 'error').mockImplementation(() => {});

      mqtt.connect = jest.fn(() => {
        return errorClient;
      })

      main();

      expect(mqtt.connect).toBeCalled();

      while(errorClient.subscribe.mock.calls.length < 1) {
        sleep(1000);
      }
      expect(errorClient.subscribe).toHaveBeenCalled();
      done();
      // setTimeout(() => {
      //   expect(errorClient.subscribe).toHaveBeenCalled();
        
      //   // const messge = log.mock.calls[0][0];

      //   // expect(messge).toContain('Error subscribing to devices topic');

      //   done();
      // }, 2000);

    });
  });

  describe.skip("ZigbeeDevice tests", () => {

  });

});