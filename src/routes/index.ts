import { Router, type IRouter } from "express";
import healthRouter from "./health";
import detoxRouter from "./detox";
import referralRouter from "./referral";
import affiliateRouter from "./affiliate";

const router: IRouter = Router();

router.use(healthRouter);
router.use(detoxRouter);
router.use(referralRouter);
router.use(affiliateRouter);

export default router;
