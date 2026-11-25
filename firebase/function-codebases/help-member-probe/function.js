import {onRequest} from 'firebase-functions/v2/https';
import {probe} from './probe.mjs';

// A synthetic transport probe, deliberately incapable of member access.
export const helpMemberAccessProbe=onRequest({
  region:'asia-northeast3',serviceAccount:'archive-help-member@archive-pilates.iam.gserviceaccount.com',
  invoker:'private',minInstances:0,maxInstances:1,timeoutSeconds:15,memory:'256MiB',cors:false
},probe);
