import { Resend } from 'resend';

const resend = new Resend('re_xxxxxxxxx');
resend.apiKeys = undefined;

resend.apiKeys.list();