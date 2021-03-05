/** If an ack hasn't been received by this time, retransmit the packet. */
export const RETRANSMIT_INTERVAL = 200;

/** Try for this long to open a connection. */
export const CONNECTION_OPEN_ATTEMPT_DURATION = 5 * 1000;

/** Connections timeout if no packet have been received in this duration. */
export const CONNECTION_TIMEOUT = 10 * 1000;

/** If no packets have been sent in this many ms, send a keep alive. */
export const KEEP_ALIVE_INTERVAL = 500;

/** Connection IDs are randomly selected within this range. */
export const CONNECTION_ID_MAX = 65536;
export const CONNECTION_ID_MIN = 1;

/** How often to tick connections. This should be smaller than RETRANSMIT_INTERVAL */
export const TICK_INTERVAL = 1000 / 10;
