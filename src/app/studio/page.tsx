import {Shell} from "@/components/shell";import {prisma} from "@/lib/prisma";import {StudioUI} from "./ui";
export default async function Studio(){const clients=await prisma.client.findMany({select:{id:true,name:true}});return <Shell><div className="page"><div className="eyebrow">Producción creativa</div><h1 className="title">Creative Studio</h1><StudioUI clients={clients}/></div></Shell>}
