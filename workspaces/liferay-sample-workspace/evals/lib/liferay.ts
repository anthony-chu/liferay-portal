import axios from "axios";

export const LIFERAY_AUTH = `Basic ${Buffer.from("test@liferay.com:test").toString("base64")}`;

export const LIFERAY_URL = "http://localhost:8080";

export const liferay = axios.create({
    baseURL: LIFERAY_URL,
    headers: { Authorization: LIFERAY_AUTH },
});
