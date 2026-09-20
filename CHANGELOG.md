# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial release: MCP server for MSP360's Managed Backup Service API.
- Company tools: `msp360_list_companies`, `msp360_get_company`.
- Computer tools: `msp360_list_computers`, `msp360_get_computer`.
- Backup plan tools: `msp360_list_plans`, `msp360_get_plan`, `msp360_get_plan_info`, `msp360_get_plan_history`, `msp360_start_plan`, `msp360_stop_plan`.
- Monitoring tools: `msp360_get_monitoring`, `msp360_get_monitoring_for_user`.
- License tools: `msp360_list_licenses`, `msp360_get_license`.
- Transparent bearer-token login and re-login (`POST /api/Provider/Login`) wrapping every tool call.
