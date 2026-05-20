import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";

export const runtime = "nodejs";

type DemoTokenRequest = {
  userId?: string;
  email?: string;
};

export async function POST(request: Request) {
  let body: DemoTokenRequest;

  try {
    body = (await request.json()) as DemoTokenRequest;
  } catch {
    return NextResponse.json(
      { message: "요청 본문이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const userId = body.userId?.trim() ?? "";
  const email = body.email?.trim() ?? "";

  if (!userId || !email) {
    return NextResponse.json(
      { message: "userId와 email은 필수입니다." },
      { status: 400 },
    );
  }

  const secret =
    process.env.JWT_SECRET ?? "mafia-casefile-local-jwt-secret";

  const token = jwt.sign(
    {
      sub: userId,
      email,
    },
    secret,
    { expiresIn: "1h" },
  );

  return NextResponse.json({ token });
}
