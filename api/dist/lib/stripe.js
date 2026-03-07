"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripe = void 0;
const stripe_1 = __importDefault(require("stripe"));
const config_1 = require("../config");
exports.stripe = config_1.config.stripe.secretKey
    ? new stripe_1.default(config_1.config.stripe.secretKey, { apiVersion: "2024-06-20" })
    : null;
//# sourceMappingURL=stripe.js.map