import { PrismaD1 } from "@prisma/adapter-d1";
import { PrismaClient } from "@prisma/client";
import { Hono } from "hono";
import { honoErrorHandler } from "middlewares/error.middleware";
import testRoutes from "routes/test.routes";
import { Bindings } from "types";


// Start a Hono app
const app = new Hono<{ Bindings: Bindings }>().basePath("/api");

app.route("/status", testRoutes);

app.onError(honoErrorHandler);

// Export the Hono app
export default app;
