import { NextRequest,NextResponse } from "next/server";
export function middleware(request:NextRequest){const token=request.cookies.get("advibe_session")?.value;if(!token)return NextResponse.redirect(new URL("/login",request.url));return NextResponse.next();}
export const config={matcher:["/dashboard/:path*","/clients/:path*","/accounts/:path*","/campaigns/:path*","/strategy/:path*","/studio/:path*","/analytics/:path*","/automations/:path*","/settings/:path*"]};
