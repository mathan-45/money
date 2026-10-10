import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";

// GET: sign-up requests waiting for approval (admin only)
export async function GET() {
  try {
    const admin = await getCurrentUser();
    if (!admin || admin.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden: Admin privileges required" },
        { status: 403 }
      );
    }

    const signups = await prisma.user.findMany({
      where: { isLocked: true },
      select: { id: true, username: true, name: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ signups });
  } catch {
    return NextResponse.json({ error: "Failed to load sign-up requests" }, { status: 500 });
  }
}

// POST: approve or reject a sign-up request (admin only)
export async function POST(req: Request) {
  try {
    const admin = await getCurrentUser();
    if (!admin || admin.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden: Admin privileges required" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const userId = String(body.userId || "");
    const action = String(body.action || "");

    if (!userId || (action !== "APPROVE" && action !== "REJECT")) {
      return NextResponse.json(
        { error: "userId and action (APPROVE or REJECT) are required" },
        { status: 400 }
      );
    }

    // Only pending (locked) accounts can be approved or rejected here
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target || !target.isLocked) {
      return NextResponse.json({ error: "Sign-up request not found" }, { status: 404 });
    }

    if (action === "APPROVE") {
      await prisma.user.update({ where: { id: userId }, data: { isLocked: false } });
    } else {
      await prisma.user.delete({ where: { id: userId } });
    }

    await prisma.auditLog.create({
      data: {
        action: action === "APPROVE" ? "UPDATE" : "DELETE",
        entity: "USER",
        entityId: userId,
        performedBy: admin.username,
        details: `${action === "APPROVE" ? "Approved" : "Rejected"} sign-up request from ${target.name} (${target.username})`,
      },
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to update sign-up request" }, { status: 500 });
  }
}