export const skillsInvokedEvaluator = (output, target) => {
    const actualSkillsInvoked = [...output.skillsInvoked];
    const expectedSkillsInvoked = [...target.skillsInvoked];

    if (actualSkillsInvoked.length !== expectedSkillsInvoked.length) {
        return 0.0;
    }

    actualSkillsInvoked.sort();
    expectedSkillsInvoked.sort();

    for (let i = 0; i < expectedSkillsInvoked.length; i++) {
        if (expectedSkillsInvoked[i] !== actualSkillsInvoked[i]) {
            return 0.0;
        }
    }

    return 1.0;
};