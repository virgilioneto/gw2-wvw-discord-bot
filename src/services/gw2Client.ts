import axios from 'axios';

export const GW2_CLIENT_TIMEOUT_MS = 10_000;

export const gw2Client = axios.create({
  timeout: GW2_CLIENT_TIMEOUT_MS,
});
