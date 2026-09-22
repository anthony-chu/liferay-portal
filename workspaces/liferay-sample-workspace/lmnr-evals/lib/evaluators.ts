export const skillsInvokedEvaluator = (output, target) => {
    const actualSkillsInvoked = new Set(output.skillsInvoked);

    return target.skillsInvoked.every((skill) => actualSkillsInvoked.has(skill))
        ? 1.0
        : 0.0;
};