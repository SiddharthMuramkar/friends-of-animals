import type { UseCaseContext } from "../../use-cases";
import { getPublicResults } from "./public";
import { decideResultsRelease, getResultsRelease, prepareResultsRelease, publishResultsRelease, type PrepareResultsInput, type ReleaseInput } from "./releases";
export { publishedResults } from "./read-published";
export const resultsUseCases=(ctx:UseCaseContext)=>({
  getResultsRelease:(input:{competitionId:string})=>getResultsRelease(ctx,input),
  prepareResultsRelease:(input:PrepareResultsInput)=>prepareResultsRelease(ctx,input),
  approveResultsRelease:(input:ReleaseInput)=>decideResultsRelease(ctx,input,true),
  rejectResultsRelease:(input:ReleaseInput)=>decideResultsRelease(ctx,input,false),
  publishResultsRelease:(input:ReleaseInput)=>publishResultsRelease(ctx,input),
  getPublicResults:(input:{slug:string})=>getPublicResults(ctx,input),
});
