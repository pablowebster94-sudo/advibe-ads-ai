import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/prisma";
const secret=()=>{const v=process.env.SESSION_SECRET;if(!v||v.length<32)throw new Error("SESSION_SECRET must contain at least 32 characters");return new TextEncoder().encode(v)};
export async function login(email:string,password:string){const user=await prisma.user.findUnique({where:{email}});if(!user||!(await compare(password,user.passwordHash)))return false;const token=await new SignJWT({sub:user.id,email:user.email,role:user.role}).setProtectedHeader({alg:"HS256"}).setIssuedAt().setExpirationTime("8h").sign(secret());const store=await cookies();store.set("advibe_session",token,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:8*60*60});return true;}
export async function currentUser(){const store=await cookies();const token=store.get("advibe_session")?.value;if(!token)return null;try{const {payload}=await jwtVerify(token,secret());if(!payload.sub)return null;return await prisma.user.findUnique({where:{id:String(payload.sub)},select:{id:true,email:true,name:true,role:true}});}catch{return null;}}
export async function requireUser(){const user=await currentUser();if(!user)throw new Error("UNAUTHORIZED");return user;}
