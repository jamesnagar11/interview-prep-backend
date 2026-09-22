import type { Request, Response } from "express";
import { createUser, loginUser, verifyToken } from "../../service/auth";

export const signup = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, msg: "Email and password are required" });
    }

    const { token } = await createUser(email, password);
    return res
      .status(201)
      .json({ success: true, msg: "User created successfully", token });
  } catch (error: any) {
    return res
      .status(400)
      .json({ success: false, msg: error.message || "Failed to signup" });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, msg: "Email and password are required" });
    }

    const { token } = await loginUser(email, password);
    return res
      .status(200)
      .json({ success: true, msg: "Login successful", token });
  } catch (error: any) {
    return res
      .status(401)
      .json({ success: false, msg: error.message || "Invalid credentials" });
  }
};

export const verifyJwt = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    let token = req.body?.token || req.query?.token;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    }

    if (!token) {
      return res
        .status(401)
        .json({ success: false, msg: "Token not provided" });
    }

    const decoded = verifyToken(token);
    return res
      .status(200)
      .json({ success: true, msg: "Token is valid", user: decoded });
  } catch (error: any) {
    return res
      .status(401)
      .json({ success: false, msg: "Invalid or expired token" });
  }
};