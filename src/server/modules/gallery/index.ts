import type { UseCaseContext } from "../../use-cases";
import { listGalleryCandidates,pickGalleryEntry,editGalleryItem,publishGalleryItem,listGalleryItemsForAdmin,hideGalleryItem,restoreGalleryItem } from "./curation";
import { featuredGalleryItems,getPublicGalleryItem,listPublicGallery,readGalleryImage,readGalleryDraftImage,type GalleryFilters } from "./read";
import { reportGalleryItem, listGalleryReports, dismissGalleryReport, issueGalleryPlainProof, type GalleryReportInput } from "./reports";
export { liveGallerySource } from "./evidence";
export { galleryRow, galleryPath, galleryMediaPath, type PublicGalleryItem } from "./read";
export const galleryUseCases=(ctx:UseCaseContext)=>({
  issueGalleryPlainProof:()=>issueGalleryPlainProof(ctx),
  reportGalleryItem:(input:GalleryReportInput)=>reportGalleryItem(ctx,input),
  listGalleryReports:()=>listGalleryReports(ctx),
  dismissGalleryReport:(input:{reportId:string})=>dismissGalleryReport(ctx,input),
  listGalleryCandidates:(input:{competitionId?:string}={})=>listGalleryCandidates(ctx,input),
  pickGalleryEntry:(input:{entryId:string})=>pickGalleryEntry(ctx,input),
  editGalleryItem:(input:Parameters<typeof editGalleryItem>[1])=>editGalleryItem(ctx,input),
  publishGalleryItem:(input:{itemId:string})=>publishGalleryItem(ctx,input),
  listGalleryItemsForAdmin:()=>listGalleryItemsForAdmin(ctx),
  hideGalleryItem:(input:Parameters<typeof hideGalleryItem>[1])=>hideGalleryItem(ctx,input),
  restoreGalleryItem:(input:{itemId:string})=>restoreGalleryItem(ctx,input),
  listPublicGallery:(input:GalleryFilters={})=>listPublicGallery(ctx,input),
  featuredGalleryItems:()=>featuredGalleryItems(ctx),
  getPublicGalleryItem:(input:{itemId:string})=>getPublicGalleryItem(ctx,input),
  readGalleryDraftImage:(input:{itemId:string})=>readGalleryDraftImage(ctx,input),
  readGalleryImage:(input:{itemId:string})=>readGalleryImage(ctx,input),
});
