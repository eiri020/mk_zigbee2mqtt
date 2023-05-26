import * as mqtt from 'mqtt';

export function subscribeCallBack(err: Error) {

  if(err) {
    console.error('Error subscribing');
  } else {
    console.info('Success subscribing');
  }
}

export function testEmitter() {

  console.info(`Connecting to MQTT Server ${process.env.MQTT_URL} ...`);

  const client  = mqtt.connect(process.env.MQTT_URL, {
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASS,
    clientId: process.env.MQTT_CLIENT ?? 'checkmk_zigbee2mqtt',
  });

  client.on('connect', () => {

    console.info(`Subscribing to MQTT topic ${process.env.SOME_TOPIC}/# ...`);

    client.subscribe(`${process.env.SOME_TOPIC}/#`, { rh: 1, qos: 0 }, subscribeCallBack);
  });

};