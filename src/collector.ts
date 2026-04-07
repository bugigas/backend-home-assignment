import mqtt from 'mqtt';
import * as amqplib from 'amqplib';
import 'dotenv/config';

const MQTT_URL = process.env.MQTT_URL;
const RABBITMQ_URL = process.env.RABBITMQ_URL;
const QUEUE_NAME = process.env.QUEUE_NAME;
const CAR_ID = 1;

// this is current state of the car, updated on every MQTT message
// two batteries
const state: any = {
  latitude: null,
  longitude: null,
  speed: null,
  gear: null,
  batteries: {
    0: { soc: null, capacity: null },
    1: { soc: null, capacity: null },
  },
};

async function main() {
  const conn = await amqplib.connect(RABBITMQ_URL);
  const ch = await conn.createChannel();
  await ch.assertQueue(QUEUE_NAME, { durable: true });

  // connect to MQTT client
  const client = mqtt.connect(MQTT_URL);

  // subscribe all topics for card with #ID 1
  client.on('connect', () => {
    console.log('MQTT client is connected');
    client.subscribe(`car/${CAR_ID}/#`);
  });

  // update state for every MQTT message.
  // we hold the last know value for gear until the new one come when the driver changes it
  // for speed same
  client.on('message', (topic: string, payload: Buffer) => {
    const parsed = JSON.parse(payload.toString());
    const val = parsed?.value ?? parsed;
    const parts = topic.split('/');

    if (parts[2] === 'location') {
      if (parts[3] === 'latitude') state.latitude = Number.parseFloat(val);
      else if (parts[3] === 'longitude') state.longitude = Number.parseFloat(val);
    } else if (parts[2] === 'speed') {
      state.speed = Number.parseFloat(val);
    } else if (parts[2] === 'gear') {
      state.gear = val;
    } else if (parts[2] === 'battery') {
      const idx = Number.parseInt(parts[3], 10);
      if (!state.batteries[idx]) state.batteries[idx] = { soc: null, capacity: null };
      if (parts[4] === 'soc') state.batteries[idx].soc = Number.parseFloat(val);
      if (parts[4] === 'capacity') state.batteries[idx].capacity = Number.parseFloat(val);
    }
  });

  // publish snapshot every 5s
  // if we dont have basic data for latitude, longitude, speed or gear the internval is skipped
  setInterval(() => {
    if (state.latitude === null || state.longitude === null || state.speed === null || state.gear === null) {
      return;
    }

    const msg = {
      car_id: CAR_ID,
      time: new Date().toISOString(),
      latitude: state.latitude,
      longitude: state.longitude,
      speed: state.speed,
      gear: state.gear,
      batteries: state.batteries,
    };

    ch.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(msg)), { persistent: true });
    console.log('queued:', msg.time, 'speed:', msg.speed, 'gear:', msg.gear);
  }, 5000);
}

main().catch(console.error);
