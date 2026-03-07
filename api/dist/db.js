"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
// Re-export prisma singleton for cron jobs and other modules
var prisma_js_1 = require("./lib/prisma.js");
Object.defineProperty(exports, "prisma", { enumerable: true, get: function () { return prisma_js_1.prisma; } });
//# sourceMappingURL=db.js.map