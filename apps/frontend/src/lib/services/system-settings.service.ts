import { APIUrl } from '@/lib/constants/url.config';
import { UpdateSystemSettingsRequest } from '@/lib/dtos/request/system-settings.req';
import {
  PublicSystemSettingsResponse,
  SystemSettingsResponse,
} from '@/lib/dtos/response/system-settings.res';
import httpClient, { httpClientWithoutToken } from '@/lib/utils/httpClient';

class SystemSettingsService {
  async getSettings() {
    const res = await httpClient.get<SystemSettingsResponse>(APIUrl.systemSettings.get());
    return res.data;
  }

  async getPublicSettings() {
    // Public endpoint, read on logged-out pages (register/sign-in) — must not
    // send a bearer token, so a 401 here is never mistaken for a session expiry.
    const res = await httpClientWithoutToken.get<PublicSystemSettingsResponse>(
      APIUrl.systemSettings.getPublic(),
    );
    return res.data;
  }

  async updateSettings(data: UpdateSystemSettingsRequest) {
    const res = await httpClient.patch<SystemSettingsResponse>(
      APIUrl.systemSettings.update(),
      data,
    );
    return res.data;
  }
}

const systemSettingsService = new SystemSettingsService();
export default systemSettingsService;
