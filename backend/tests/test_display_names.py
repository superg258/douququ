from backend.app.display_names import attach_school_display_names


def test_display_override_is_attached_after_and_cannot_replace_identity() -> None:
    identity = {
        "schoolKey": "canonical-school",
        "teamKey": "canonical-school::team",
        "collegeName": "完整学校名称",
        "teamName": "Team",
    }
    displayed = attach_school_display_names(
        identity,
        overrides={
            "canonical-school": {
                "displayName": "展示名称",
                "abbreviation4": "四字简称",
                "abbreviation2": "简称",
                "schoolKey": "malicious-replacement",
            }
        },
    )
    assert displayed["schoolKey"] == "canonical-school"
    assert displayed["teamKey"] == "canonical-school::team"
    assert displayed["displaySchoolName"] == "展示名称"
    assert displayed["schoolAbbreviation4"] == "四字简称"
    assert displayed["schoolAbbreviation2"] == "简称"
