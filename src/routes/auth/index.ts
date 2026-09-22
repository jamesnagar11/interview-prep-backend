import { Router } from "express";
import { signup, login, verifyJwt } from "../../controllers/auth";

const authRouter = Router();

authRouter.post("/signup", signup);
authRouter.post("/login", login);
authRouter.get("/verify", verifyJwt);
authRouter.post("/verify", verifyJwt);

export default authRouter;
