# mk_zigbee2mqtt

Repository: https://github.com/eiri020/mk_zigbee2mqtt

## Building and running local with .env file
```
npm run build
```

### Local .env file
```
MQTT_URL=mqtt://somehost
MQTT_USER=somemqttuser
MQTT_PASS=somepass
MQTT_CLIENT=checkmk_zigbee2mqtt
ZIGBEE2MQTT_TOPIC=zigbee2mqtt
CHECKMK_PIGGYBAG=zigbee2mqtt
SPOOL_DIR='/usr/lib/mk_check_mk_agent'
```

## Running local
```
npm run start
```


## Creating docker image
```
npm run image
```

## Configure your host to use secrets
```
docker swarm init
echo passwd | docker secret create mosquitto_passwd -
```

### Verifiy passwd
```
docker secret ls 
```

## docker-compose file

```
version: '3.8'
services:
  mk_zigbee2mqtt:
    container_name: mk_zigbee2mqtt
    restart: unless-stopped
    image: mk_zigbee2mqtt
    volumes:
      - /usr/lib/mk_check_mk_agent:/app/spool
    environment:
      MQTT_URL: "mqtt://moquitto_url"
      MQTT_USER: "mosquitto_user"
      MQTT_PASS: /run/secrets/mosquitto_passwd
      MQTT_CLIENT: checkmk_zigbee2mqtt
      ZIGBEE2MQTT_TOPIC: zigbee2mqtt
      CHECKMK_PIGGYBAG: zigbee2mqtt
      SPOOL_DIR: /app/spool
    secrets:
      - mosquitto_passwd


secrets:
  mosquitto_passwd:
    external: true
```



npm run image


configuration