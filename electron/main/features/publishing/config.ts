import { getBackendUrl } from "../../infra/settings/BackendConfig";

export function getPublishBaseUrl(): string {
	return getBackendUrl();
}
