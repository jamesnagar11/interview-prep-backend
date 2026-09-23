import { Router } from "express";
import { signup, signin, verifyJwt } from "../../controllers/auth";

const authRouter = Router();

authRouter.post("/signup", signup);
authRouter.post("/signin", signin);
authRouter.get("/verify", verifyJwt);
authRouter.post("/verify", verifyJwt);

export default authRouter;
