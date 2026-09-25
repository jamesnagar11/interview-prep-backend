import express from "express";
import dotenv from "dotenv";
import authRouter from "./routes/auth";
import kitsRouter from "./routes/kits";
import builderRouter from "./routes/builder";
import practiceRouter from "./routes/practice";
import mockExamRouter from "./routes/mockExam";
import cors from "cors";

dotenv.config();

// LangSmith auto-disable check: if tracing is requested but API key is empty/missing, disable tracing to avoid 403 network errors
if (!process.env.LANGCHAIN_API_KEY || process.env.LANGCHAIN_API_KEY.trim() === '' || process.env.LANGCHAIN_API_KEY.includes('your_langsmith_api_key')) {
  process.env.LANGCHAIN_TRACING_V2 = 'false';
}

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: "*",
  credentials: true,
}));

app.use(express.json());

app.use("/api/auth", authRouter);
app.use("/api", kitsRouter);
app.use("/api", builderRouter);
app.use("/api", practiceRouter);
app.use("/api", mockExamRouter);

app.get("/", (req, res) => {
  res.send("Hi");
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  if (process.env.LANGCHAIN_TRACING_V2 === 'true') {
    if (process.env.LANGCHAIN_API_KEY) {
      console.log(`📊 LangSmith tracing active for project: "${process.env.LANGCHAIN_PROJECT || 'ai-interview-prep'}"`);
    } else {
      console.log(`⚠️ LangSmith tracing enabled (LANGCHAIN_TRACING_V2=true). Set LANGCHAIN_API_KEY in .env to send traces.`);
    }
  }
});