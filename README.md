## Running the services

Every service required to complete the assignment is defined in the `docker-compose.yml` file. To run it simply execute:

```sh
docker-compose up -d
```

This will start a Postgres database on local port `55432`, Mosquitto MQTT broker on port `51883`, RabbitMQ on port `55672` and helper script which will initialize the database tables and start the electrical car simulation. All important credentials for connecting to the services can be seen in the `docker-compose.yml` file itself.

### EDITED and new comments
### Note on Postgres volume

`postgres:latest` is currently version 18, which changed the default data directory structure. If you run into an unhealthy postgres container, the fix is to update the volume mount in `docker-compose.yml`:

```yaml
# change this
- postgres_data:/var/lib/postgresql/data
# to this
- postgres_data:/var/lib/postgresql
```

Postgres 18 creates a version-specific subdirectory under `/var/lib/postgresql` automatically. Mounting directly to `/data` breaks the healthcheck.

## Implementation

### Configuration

The project uses a `.env` file for configuration. Copy `.env.example` and fill in values:

```sh
cp .env.example .env
```

### Running the pipeline

Install dependencies:

```sh
npm install
```

Start the writer first (needs to be ready before messages arrive):

```sh
npm run writer
```

Then start the collector in a separate terminal:

```sh
npm run collector
```

### How it works

**collector.ts** connects to MQTT and subscribes to all topics for car `1`. It keeps the last known value for each field — gear only comes when the driver changes it, speed can be delayed, so holding the previous value keeps the timeseries continuous. Every 5 seconds it publishes a snapshot to RabbitMQ. If core fields (lat, lon, speed, gear) haven't arrived yet, the interval is skipped.

**writer.ts** consumes messages from the queue and inserts into `car_state`. Transformations applied before insert:

- Gear: `N → 0`, `1-6 → integer`
- Speed: `m/s × 3.6 → km/h`
- State of charge: weighted average — `(soc0 * cap0 + soc1 * cap1) / (cap0 + cap1)`, rounded to integer

### Possible extensions

- There is an option to extend and replace raw `pg` queries with **Prisma** — would give typed schema and auto-generated client, useful if the schema grows or migrations are needed
- The queue name and connection strings are in `.env` but could also be validated at startup with something like `zod` to fail fast on misconfiguration

### Tests

```sh
npm test
```

Unit tests (Vitest) cover `computeSoc` weighted average logic and gear/speed conversion. The collector has no pure functions worth testing separately — it's all I/O and state, so the logic lives in the writer.

### Example data generated and saved in DB and possible result

- MQTT → Queue (collector):
```
queued: 2026-04-07T19:21:01Z  speed: 0.15 m/s  gear: 1
queued: 2026-04-07T19:21:06Z  speed: 1.20 m/s  gear: 1
queued: 2026-04-07T19:21:11Z  speed: 2.27 m/s  gear: 1
```
Queue → DB (writer), every 5 sec:
```
time                    | soc | lat       | lon          | gear | speed_kmh
2026-04-07 19:21:01.389 |  53 | 37.765952 | -122.420189  |  1   |  0.55
2026-04-07 19:21:06.390 |  53 | 37.765947 | -122.420133  |  1   |  4.32
2026-04-07 19:21:11.391 |  53 | 37.765938 | -122.420020  |  1   |  8.16
...
2026-04-07 19:22:29.948 |  52 | 37.765957 | -122.418555  |  3   | 59.45  ← gear changed on 3
2026-04-07 19:22:34.949 |  52 | 37.765968 | -122.418442  |  4   | 63.15  ← gear on 4
2026-04-07 19:23:04.956 |  51 | 37.766046 | -122.417883  |  5   | 80.22  ← gear on 5
```

We can see the car accelerates from (0 → 80 km/h), changed gear up (1→3→4→5) and SOC is slowding down (53→51). Exactly 5s granularity.
