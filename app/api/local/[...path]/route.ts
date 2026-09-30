import { proxyLocal } from "@/lib/local-proxy";

export function GET(request: Request) { return proxyLocal(request); }
export function HEAD(request: Request) { return proxyLocal(request); }
export function POST(request: Request) { return proxyLocal(request); }
export function PUT(request: Request) { return proxyLocal(request); }
export function PATCH(request: Request) { return proxyLocal(request); }
export function DELETE(request: Request) { return proxyLocal(request); }
