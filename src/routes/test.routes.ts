import { AppEnv, Hono } from "hono";
import * as TestController from '../controllers/test.controller';

const testRoutes = new Hono<AppEnv>();

// testRoutes.get('/users', TestController.getUsers);

testRoutes.get('/', TestController.getStatus);

export default testRoutes;