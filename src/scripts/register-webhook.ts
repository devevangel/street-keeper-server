/**
 * One-time: register Strava push subscription so webhooks hit our server.
 *
 * Usage: STRAVA_CLIENT_ID STRAVA_CLIENT_SECRET STRAVA_WEBHOOK_VERIFY_TOKEN BASE_URL npm run webhook:register
 *
 * @see https://developers.strava.com/docs/webhooks/
 */

import "dotenv/config";
import axios from "axios";
import { getEnvVar } from "../config/constants.js";

async function main(): Promise<void> {
  const clientId = getEnvVar("STRAVA_CLIENT_ID");
  const clientSecret = getEnvVar("STRAVA_CLIENT_SECRET");
  const verifyToken =
    process.env.STRAVA_WEBHOOK_VERIFY_TOKEN ?? "street-keeper-verify-token";
  const baseUrl = process.env.BASE_URL ?? "http://localhost:8000";
  const callbackUrl = `${baseUrl.replace(/\/$/, "")}/api/v1/webhooks/strava`;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    callback_url: callbackUrl,
    verify_token: verifyToken,
  });

  console.log(`Registering webhook: callback_url=${callbackUrl}`);

  const res = await axios.post(
    "https://www.strava.com/api/v3/push_subscriptions",
    body,
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 30000,
    }
  );

  console.log("Subscription created:", res.data);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
