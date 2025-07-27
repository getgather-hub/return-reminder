import { NextFunction, Request, Response } from 'express';
import { ProxyService } from './proxy-service.js';

const blockedDomains = [
  // Amazon
  'amazonaws.com',
  'compute.amazonaws.com',

  // Google Cloud
  'google.com',
  'googleusercontent.com',
  'cloud.google.com',
  'gcp.gvt2.com',

  // Microsoft Azure
  'microsoft.com',
  'azure.com',
  'cloudapp.net',

  // Alibaba Cloud
  'alibaba.com',
  'aliyun.com',
  'alibabacloud.com',

  // DigitalOcean
  'digitalocean.com',

  // Oracle Cloud
  'oracle.com',
  'oraclecloud.com',

  // OVH
  'ovh.net',
  'ovhcloud.com',

  // Linode
  'linode.com',

  // Hetzner
  'hetzner.com',
  'hetzner.de',

  // Vultr
  'vultr.com',

  // Tencent Cloud
  'tencent.com',
  'tencentcloud.com',

  // IBM Cloud
  'ibm.com',
  'softlayer.com',

  'choopa.com', // Sometimes associated with scanning activity
  'leaseweb.com',
  'contabo.com',
  'cloudsigma.com',
];

export const ipBlocker =
  (proxyService: ProxyService) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ip = proxyService.getClientIp(req);
      const result = await proxyService.getClientLocation(ip);
      if (result) {
        console.log('[ipBlocker] ip: ', ip, ' domain: ', result.traits?.domain);
      }
      if (result && result.traits?.domain) {
        const domain = result.traits.domain;

        if (
          blockedDomains.some((cloudDomain) =>
            domain.toLowerCase().includes(cloudDomain)
          )
        ) {
          console.log('[ipBlocker] blocked domain: ', domain);
          const delay = 3000 + Math.random() * 5000;
          setTimeout(() => {
            res.status(403).send('Access denied.');
          }, delay);
          return;
        }
      }

      next();
    } catch (error) {
      console.error('GeoIP lookup error:', error);
      next();
    }
  };
