/**
 * SPDX-FileCopyrightText: (c) 2026 Liferay, Inc. https://liferay.com
 * SPDX-License-Identifier: LGPL-2.1-or-later OR LicenseRef-Liferay-DXP-EULA-2.0.0-2023-06
 */

package com.liferay.client.extension.upgrade.v3_5_2.test;

import com.liferay.arquillian.extension.junit.bridge.junit.Arquillian;
import com.liferay.petra.string.StringBundler;
import com.liferay.petra.string.StringPool;
import com.liferay.portal.kernel.dao.db.DB;
import com.liferay.portal.kernel.dao.db.DBManagerUtil;
import com.liferay.portal.kernel.dao.jdbc.DataAccess;
import com.liferay.portal.kernel.upgrade.UpgradeProcess;
import com.liferay.portal.test.rule.Inject;
import com.liferay.portal.test.rule.LiferayIntegrationTestRule;
import com.liferay.portal.upgrade.registry.UpgradeStepRegistrator;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;

import java.util.Objects;

import org.junit.After;
import org.junit.Assert;
import org.junit.ClassRule;
import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * @author Anthony Chu
 */
@RunWith(Arquillian.class)
public class CETConfigurationCleanupUpgradeProcessTest {

	@ClassRule
	@Rule
	public static final LiferayIntegrationTestRule liferayIntegrationTestRule =
		new LiferayIntegrationTestRule();

	@After
	public void tearDown() throws Exception {
		DB db = DBManagerUtil.getDB();

		db.runSQL(
			StringBundler.concat(
				"delete from Configuration_ where configurationId like '",
				_CET_CONFIGURATION_PID_PREFIX,
				"upgrade-test%' or configurationId = '", _UNRELATED_PID, "'"));
	}

	@Test
	public void testUpgrade() throws Exception {
		String staleCETConfigurationId =
			_CET_CONFIGURATION_PID_PREFIX + "upgrade-test-cet/liferay.com";

		_insertConfiguration(staleCETConfigurationId);

		_insertConfiguration(_UNRELATED_PID);

		UpgradeProcess upgradeProcess = _getUpgradeProcess();

		Assert.assertNotNull(
			"CET configuration cleanup upgrade step must be registered",
			upgradeProcess);

		upgradeProcess.upgrade();

		Assert.assertFalse(
			"Stale CET Configuration_ row should be deleted",
			_exists(staleCETConfigurationId));
		Assert.assertTrue(
			"Unrelated Configuration_ row should survive",
			_exists(_UNRELATED_PID));
	}

	private boolean _exists(String configurationId) throws Exception {
		try (Connection connection = DataAccess.getConnection();

			PreparedStatement preparedStatement = connection.prepareStatement(
				"select configurationId from Configuration_ where " +
					"configurationId = ?")) {

			preparedStatement.setString(1, configurationId);

			try (ResultSet resultSet = preparedStatement.executeQuery()) {
				return resultSet.next();
			}
		}
	}

	private UpgradeProcess _getUpgradeProcess() {
		UpgradeProcess[] upgradeProcesses = new UpgradeProcess[1];

		_upgradeStepRegistrator.register(
			(fromSchemaVersionString, toSchemaVersionString, upgradeSteps) -> {
				if (Objects.equals(fromSchemaVersionString, "3.5.1") &&
					Objects.equals(toSchemaVersionString, "3.5.2") &&
					(upgradeSteps.length > 0)) {

					upgradeProcesses[0] = (UpgradeProcess)upgradeSteps[0];
				}
			});

		return upgradeProcesses[0];
	}

	private void _insertConfiguration(String configurationId) throws Exception {
		try (Connection connection = DataAccess.getConnection();

			PreparedStatement preparedStatement = connection.prepareStatement(
				"insert into Configuration_ (configurationId, dictionary) " +
					"values (?, ?)")) {

			preparedStatement.setString(1, configurationId);
			preparedStatement.setString(2, StringPool.BLANK);

			preparedStatement.executeUpdate();
		}
	}

	private static final String _CET_CONFIGURATION_PID_PREFIX =
		"com.liferay.client.extension.type.configuration.CETConfiguration~";

	private static final String _UNRELATED_PID =
		"com.liferay.client.extension.upgrade.test.unrelated";

	@Inject(
		filter = "component.name=com.liferay.client.extension.internal.upgrade.registry.ClientExtensionUpgradeStepRegistrator"
	)
	private UpgradeStepRegistrator _upgradeStepRegistrator;

}