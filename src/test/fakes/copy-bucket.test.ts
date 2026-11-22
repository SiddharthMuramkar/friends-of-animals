import { copyBucketContract } from "@/server/ports/copy-bucket.contract";

import { FakeCopyBucket } from "./copy-bucket";

copyBucketContract("FakeCopyBucket", async () => ({
  store: new FakeCopyBucket(),
  bucket: "foa-offsite-test",
  prefix: "contract/",
}));
