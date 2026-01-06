import { getBackendUrl } from "../../infra/settings/BackendConfig";

export function getSocialApiBaseUrl(): string {
	return getBackendUrl();
}
