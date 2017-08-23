/**
 * Copyright (c) 2000-present Liferay, Inc. All rights reserved.
 *
 * This library is free software; you can redistribute it and/or modify it under
 * the terms of the GNU Lesser General Public License as published by the Free
 * Software Foundation; either version 2.1 of the License, or (at your option)
 * any later version.
 *
 * This library is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU Lesser General Public License for more
 * details.
 */

package com.liferay.blogs.functional.test;

import com.liferay.poshi.runner.selenium.LiferaySelenium;
import com.liferay.poshi.runner.selenium.SeleniumUtil;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

public class BlogsFunctionalTest {

	@Before
	public void setup() throws Exception {
		SeleniumUtil.startSelenium();

		_liferaySelenium = SeleniumUtil.getSelenium();

		_liferaySelenium.open("http://localhost:8080");
	}

	@After
	public void teardown() throws Exception {
		SeleniumUtil.stopSelenium();
	}

	@Test
	public void testSignIn() throws Exception {
		Thread.sleep(10000);

		_liferaySelenium.waitForElementPresent("//span[contains(@class,'sign-in')]/a");

		_liferaySelenium.waitForText("//span[contains(@class,'sign-in')]/a", "Sign In");

		_liferaySelenium.assertText("//span[contains(@class,'sign-in')]/a", "Sign In");

		_liferaySelenium.click("//span[contains(@class,'sign-in')]/a");

		_liferaySelenium.waitForElementPresent("//div[label[contains(.,'Email Address')]]/input[@type='text']");

		_liferaySelenium.type("//div[label[contains(.,'Email Address')]]/input[@type='text']", "test@liferay.com");

		_liferaySelenium.waitForElementPresent("//div[label[contains(.,'Password')]]/input");

		_liferaySelenium.type("//div[label[contains(.,'Password')]]/input", "test");

		_liferaySelenium.waitForElementPresent("//label[contains(.,'Remember Me')]/input[@type='checkbox']");

		_liferaySelenium.check("//label[contains(.,'Remember Me')]/input[@type='checkbox']");

		_liferaySelenium.waitForElementPresent("//button[contains(.,'Sign In')]");

		_liferaySelenium.waitForText("//button[contains(.,'Sign In')]", "Sign In");

		_liferaySelenium.assertText("//button[contains(.,'Sign In')]", "Sign In");

		_liferaySelenium.click("//button[contains(.,'Sign In')]");

		Thread.sleep(30);
	}

	private static LiferaySelenium _liferaySelenium;
}