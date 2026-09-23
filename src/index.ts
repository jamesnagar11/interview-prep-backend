import express from "express";
import dotenv from "dotenv";
import authRouter from "./routes/auth";
import cors from "cors";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: "*",
  credentials: true,
}));

app.use(express.json());

app.use("/api/auth", authRouter);

app.get("/", (req, res) => {
  res.send("Hi");
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));