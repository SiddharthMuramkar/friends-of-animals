import { connection } from "next/server";
import { as,currentActor } from "@/server/app";
import { DomainError,errorSummaryForLogs } from "@/server/errors";

export async function GET(_request:Request,{params}:{params:Promise<{code:string}>}){
  await connection();
  const [{code},actor]=await Promise.all([params,currentActor()]);
  const headers={"Cache-Control":"no-store"};
  try{
    const result=await as(actor).exportCompetitionReportCsv({competitionCode:code});
    if(!result.ok)return new Response(null,{status:result.error==="not_found"?404:400,headers});
    return new Response(result.csv,{headers:{...headers,"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="${result.filename}"`,"X-Content-Type-Options":"nosniff"}});
  }catch(error){
    if(error instanceof DomainError)return new Response(null,{status:403,headers});
    throw new Error(`Report export failed: ${errorSummaryForLogs(error)}`);
  }
}
