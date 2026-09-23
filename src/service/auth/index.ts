import jwt from "jsonwebtoken";
import { db } from "../../prisma/db";

const SALT = process.env.SALT || "";
const JWT_SECRET = process.env.JWT_SECRET || "default_jwt_secret";

export interface JwtPayload {
  userId: string;
  email: string;
  name: string;
}

export const generateToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
};

export const verifyToken = (token: string): JwtPayload => {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
};

export const createUser = async (email: string, password: string, name: string) => {
  const exist = await db.orm.user.where({ email: email }).first();
  if (exist) {
    throw new Error("User already exists");
  }

  const hashedPassword = await Bun.password.hash(password + SALT, {
    algorithm: "bcrypt",
  });

  const user = await db.orm.user.create({
    email: email,
    passwordHash: hashedPassword,
    name: name,
    createdAt: new Date(),
  });

  const token = generateToken({
    userId: user._id.toString(),
    email: user.email,
    name: user.name
  });

  return { user, token };
};

export const loginUser = async (email: string, password: string) => {
  const user = await db.orm.user.where({ email: email }).first();
  if (!user) {
    throw new Error("Invalid email or password");
  }

  const isValidPassword = await Bun.password.verify(
    password + SALT,
    user.passwordHash
  );

  if (!isValidPassword) {
    throw new Error("Invalid email or password");
  }

  const token = generateToken({
    userId: user._id.toString(),
    email: user.email,
    name: user.name
  });

  return { user, token };
};