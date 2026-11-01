import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main(){
  await prisma.adAccount.upsert({where:{externalId:"PENDING_IMPERIO_BARBER_STUDIO"},update:{},create:{externalId:"PENDING_IMPERIO_BARBER_STUDIO",name:"Imperio Barber Studio",status:"PENDING"}});
  await prisma.adAccount.upsert({where:{externalId:"PENDING_ADVIBE_AGENCIA"},update:{},create:{externalId:"PENDING_ADVIBE_AGENCIA",name:"AdVibe Agencia",status:"PENDING"}});
}
main().finally(()=>prisma.$disconnect());
