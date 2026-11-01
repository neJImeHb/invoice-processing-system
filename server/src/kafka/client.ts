import { Kafka } from "kafkajs";

const CLIENT_ID = "invoice-api";
const TIMEOUT_MS = 3000;

export function createKafka(brokers: string): Kafka {
  const brokerList = brokers
    .split(",")
    .map((broker) => broker.trim())
    .filter((broker) => broker.length > 0);

  return new Kafka({
    clientId: CLIENT_ID,
    brokers: brokerList,
    connectionTimeout: TIMEOUT_MS,
    requestTimeout: TIMEOUT_MS,
  });
}
