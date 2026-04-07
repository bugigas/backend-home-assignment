import * as amqplib from 'amqplib';
import { Pool } from 'pg';
import 'dotenv/config';

const RABBITMQ_URL = process.env.RABBITMQ_URL!;
const QUEUE_NAME = process.env.QUEUE_NAME!;

const db = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// iterate over batteries, every battery which has soc and capacity
// add soc * capacity to weighted
// add capacity to totalCap
// return weighted/totalCap

export function computeSoc(batteries: any): number | null {
  let totalCap = 0;
  let weighted = 0;

  for (const b of Object.values(batteries) as any[]) {
    if (b.soc != null && b.capacity != null) {
      weighted += b.soc * b.capacity;
      totalCap += b.capacity;
    }
  }

  return totalCap > 0 ? weighted / totalCap : null;
}

async function main() {
  // connect for RabbitMQ and PostgreSQL
  const conn = await amqplib.connect(RABBITMQ_URL);
  const ch = await conn.createChannel();
  await ch.assertQueue(QUEUE_NAME, { durable: true });
  ch.prefetch(1);
  // waiting for messages in qeueue
  console.log('waiting for new messages...');

  ch.consume(QUEUE_NAME, async (msg) => {
    if (!msg) return;

    const data = JSON.parse(msg.content.toString());

    // Gear: N -> 0, value 1-6 integer
    // Speed: X * 3.6 (m/s -> km/h)
    // SOC: weighted average of battery capacities -> (soc0 * cap0 + soc1 * cap1) / (cap0 + cap1)
    // option: to wrap this logic into single functions
    const gear = data.gear === 'N' ? 0 : Number.parseInt(data.gear, 10);
    const speed = data.speed * 3.6; // m/s -> km/h
    const soc = computeSoc(data.batteries);
    const socInt = soc !== null ? Math.round(soc) : null;

    try {
      // insert new row to car_state table in database
      await db.query(
        `INSERT INTO car_state (car_id, time, state_of_charge, latitude, longitude, gear, speed)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [data.car_id, data.time, socInt, data.latitude, data.longitude, gear, speed]
      );
      console.log(`inserted car=${data.car_id}, time=${data.time}, soc=${socInt}, speed=${speed.toFixed(1)}km/h`);
      // after successfully inserted we confirm the message with ack
      // if there are any errors we nack message back to queue
      ch.ack(msg);
    } catch (err) {
      console.error(`this insert failed, Error = ${err}`);
      ch.nack(msg, false, false);
    }
  });
}

main().catch(console.error);
