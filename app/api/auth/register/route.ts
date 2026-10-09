import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/session";

// Simple in-memory rate limit: max 5 sign-ups per IP per hour
const attempts = new Map<string, number[]>();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const MAX_PENDING = 50;

function tooManyRequests(ip: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    attempts.set(ip, recent);
    return true;
  }
  recent.push(now);
  attempts.set(ip, recent);
  return false;
}

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    if (tooManyRequests(ip)) {
      return NextResponse.json(
        { error: "Too many sign-up attempts. Please try again later." },
        { status: 429 }
      );
    }

    const body = await req.json();
    const name = String(body.name || "").trim();
    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    if (name.length < 2 || name.length > 60) {
      return NextResponse.json({ error: "Name must be 2 to 60 characters" }, { status: 400 });
    }
    if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username)) {
      return NextResponse.json(
        { error: "Username must be 3 to 30 characters (letters, numbers, . _ -)" },
        { status: 400 }
      );
    }
    if (password.length < 8 || password.length > 100) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    // Stop the pending list from being flooded
    const pendingCount = await prisma.user.count({ where: { isLocked: true } });
    if (pendingCount >= MAX_PENDING) {
      return NextResponse.json(
        { error: "Sign-ups are temporarily closed. Please contact the admin." },
        { status: 429 }
      );
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return NextResponse.json({ error: "Username is already taken" }, { status: 409 });
    }

    // Account is created locked: it cannot log in until an admin approves it
    const user = await prisma.user.create({
      data: {
        username,
        name,
        passwordHash: await hashPassword(password),
        role: "PARTNER",
        isLocked: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: "CREATE",
        entity: "USER",
        entityId: user.id,
        performedBy: username,
        details: `Sign-up request from ${name} (${username}), waiting for admin approval`,
      },
    });

    return NextResponse.json(
      {
        success: true,
        pending: true,
        message: "Account created. An admin must approve it before you can log in.",
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 });
  }
}