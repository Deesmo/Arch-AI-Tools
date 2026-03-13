import Stripe from "stripe";
import { config } from "../config.js";

export const stripe = config.stripe.secretKey
  ? new Stripe(config.stripe.secretKey, { apiVersion: "2025-02-24.acacia" })
  : null;
