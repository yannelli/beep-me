import { discord } from "./discord";
import { gmail } from "./gmail";
import { ntfy } from "./ntfy";
import { pushover } from "./pushover";
import { resend } from "./resend";
import { slack } from "./slack";
import { smtp } from "./smtp";
import { telegram } from "./telegram";
import { telnyx } from "./telnyx";
import { twilio } from "./twilio";
import type { AdapterRegistry } from "./types";
import { webhook } from "./webhook";

export const adapters: AdapterRegistry = {
  telegram,
  twilio,
  telnyx,
  resend,
  gmail,
  smtp,
  slack,
  discord,
  ntfy,
  pushover,
  webhook,
};
