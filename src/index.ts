import { PrismaD1 } from "@prisma/adapter-d1";
import { PrismaClient } from "@prisma/client";
import authRoutesController from "controllers/auth.controller";
import budgetRoutesController from "controllers/budget.controller";
import expenseRoutesController from "controllers/expense.controller";
import fuelTypeRoutesController from "controllers/fuelType.controller";
import noteRoutesController from "controllers/note.controller";
import reportRoutesController from "controllers/report.controller";
import reviewRoutesController from "controllers/review.controller";
import stationRoutesController from "controllers/station.controller";
import userRoutesController from "controllers/user.controller";
import vehicleRoutesController from "controllers/vehicle.controller";
import vehicleCategoryRoutesController from "controllers/vehicleCategory.controller";
import { Hono } from "hono";
import { honoErrorHandler } from "middlewares/error.middleware";
import seedRoutes from "routes/seed.routes";
import testRoutes from "routes/test.routes";
import { Bindings } from "types";


// Start a Hono app
const app = new Hono<{ Bindings: Bindings }>().basePath("/api");

app.route("/seed", seedRoutes);
app.route("/auth", authRoutesController);
app.route("/vehicles", vehicleRoutesController);
app.route("/status", testRoutes);
app.route('/users', userRoutesController);
app.route('/stations', stationRoutesController);
app.route('/notes', noteRoutesController); // Add note management routes
app.route('/expenses', expenseRoutesController);
app.route('/vehicle-categories', vehicleCategoryRoutesController);
app.route('/fuel-types', fuelTypeRoutesController);
app.route('/reviews', reviewRoutesController);
app.route('/budgets', budgetRoutesController);
app.route('/reports', reportRoutesController);

app.onError(honoErrorHandler);

// Export the Hono app
export default app;
