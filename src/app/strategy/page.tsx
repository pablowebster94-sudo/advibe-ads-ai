import {Shell} from "@/components/shell";import {prisma} from "@/lib/prisma";import {StrategyUI} from "./ui";
export default async function Strategy(){const clients=await prisma.client.findMany({select:{id:true,name:true}});return <Shell><div className="page"><div className="eyebrow">Planificación</div><h1 className="title">Estrategia IA</h1><StrategyUI clients={clients}/></div></Shell>}
