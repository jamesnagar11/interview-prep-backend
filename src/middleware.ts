import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "default_jwt_secret";

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
      };
    }
  }
}

export const isAuth = (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, msg: "Token not provided" });
    }
    const token = authHeader.split(" ")[1];
    if(!token) {
        return res.status(401).json({ success: false, msg: "Token not provided" });
    }
    const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload & {
      userId: string;
      email: string;
    };
    if(!decoded) {
        return res.status(401).json({ success: false, msg: "Invalid token" });
    }
    req.user = { userId: decoded.userId, email: decoded.email };
    next();
  } catch (error) {
    return res.status(401).json({ success: false, msg: "Invalid or expired token" });
  }
};